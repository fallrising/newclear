// internal/fetcher/fetcher.go

package fetcher

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/html"
)

type PageContent struct {
	Title       string
	Description string
	Tags        []string
	FetchError  string
}

type FetchConfig struct {
	Timeout           time.Duration
	UserAgent         string
	DomainDelay       time.Duration
	MaxConcurrentDomains int
	MaxFailuresPerDomain int
	SkipDomainCooldown   time.Duration
	BulkMode          bool
}

type DomainState struct {
	lastRequest   time.Time
	failureCount  int
	skippedUntil  time.Time
	mu            sync.Mutex
}

type Fetcher struct {
	config      *FetchConfig
	domainStates map[string]*DomainState
	mu          sync.RWMutex
}

var (
	defaultFetcher *Fetcher
	once           sync.Once
)

func GetDefaultFetcher() *Fetcher {
	once.Do(func() {
		defaultFetcher = NewFetcher(&FetchConfig{
			Timeout:              250 * time.Millisecond,
			UserAgent:            "Goku-Bookmark-Manager/1.0 (+https://github.com/fallrising/goku)",
			DomainDelay:          0,
			MaxConcurrentDomains: 10,
			MaxFailuresPerDomain: 3,
			SkipDomainCooldown:   5 * time.Minute,
			BulkMode:             false,
		})
	})
	return defaultFetcher
}

func NewFetcher(config *FetchConfig) *Fetcher {
	return &Fetcher{
		config:       config,
		domainStates: make(map[string]*DomainState),
	}
}

func (f *Fetcher) getDomainState(domain string) *DomainState {
	f.mu.RLock()
	state, exists := f.domainStates[domain]
	f.mu.RUnlock()

	if !exists {
		f.mu.Lock()
		state, exists = f.domainStates[domain]
		if !exists {
			state = &DomainState{}
			f.domainStates[domain] = state
		}
		f.mu.Unlock()
	}
	return state
}

func (f *Fetcher) shouldSkipDomain(domain string) bool {
	state := f.getDomainState(domain)
	state.mu.Lock()
	defer state.mu.Unlock()

	if time.Now().Before(state.skippedUntil) {
		return true
	}

	if state.failureCount >= f.config.MaxFailuresPerDomain {
		state.skippedUntil = time.Now().Add(f.config.SkipDomainCooldown)
		return true
	}

	return false
}

func (f *Fetcher) waitForDomain(domain string) {
	if f.config.DomainDelay == 0 {
		return
	}

	state := f.getDomainState(domain)
	state.mu.Lock()
	defer state.mu.Unlock()

	if !state.lastRequest.IsZero() {
		elapsed := time.Since(state.lastRequest)
		if elapsed < f.config.DomainDelay {
			time.Sleep(f.config.DomainDelay - elapsed)
		}
	}
	state.lastRequest = time.Now()
}

func (f *Fetcher) recordFailure(domain string) {
	state := f.getDomainState(domain)
	state.mu.Lock()
	defer state.mu.Unlock()
	state.failureCount++
}

func (f *Fetcher) recordSuccess(domain string) {
	state := f.getDomainState(domain)
	state.mu.Lock()
	defer state.mu.Unlock()
	state.failureCount = 0
	state.skippedUntil = time.Time{}
}

func (f *Fetcher) FetchPageContent(pageURL string) (*PageContent, bool, error) {
	// Validate URL structure
	parsedURL, err := url.ParseRequestURI(pageURL)
	if err != nil {
		return &PageContent{FetchError: fmt.Sprintf("Invalid URL format: %v", err)}, false, nil
	}

	// Check if the URL has a valid host
	if parsedURL.Host == "" {
		return &PageContent{FetchError: "URL must have a valid host"}, false, nil
	}

	domain := parsedURL.Hostname()

	// Check if we should skip this domain due to previous failures
	if f.shouldSkipDomain(domain) {
		return &PageContent{FetchError: "Domain temporarily skipped due to repeated failures"}, false, nil
	}

	if ValidateIfInternalIP(pageURL) {
		return &PageContent{FetchError: "Internal IP addresses are not supported"}, false, nil
	}

	alive, err := IsWebsiteAccessible(pageURL)
	if err != nil {
		f.recordFailure(domain)
		return &PageContent{FetchError: fmt.Sprintf("Failed to check website accessibility: %v", err)}, true, nil
	}
	if !alive {
		f.recordFailure(domain)
		return &PageContent{FetchError: "Website is not accessible"}, false, nil
	}

	// Wait for domain rate limiting
	f.waitForDomain(domain)

	client := &http.Client{
		Timeout: f.config.Timeout,
	}

	req, err := http.NewRequest("GET", pageURL, nil)
	if err != nil {
		f.recordFailure(domain)
		return &PageContent{FetchError: fmt.Sprintf("Failed to create request: %v", err)}, false, nil
	}

	req.Header.Set("User-Agent", f.config.UserAgent)

	resp, err := client.Do(req)
	if err != nil {
		f.recordFailure(domain)
		return &PageContent{FetchError: fmt.Sprintf("Failed to fetch URL: %v", err)}, false, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		f.recordFailure(domain)
		return &PageContent{FetchError: fmt.Sprintf("HTTP code: %d, cannot get metadata", resp.StatusCode)}, false, nil
	}

	doc, err := html.Parse(resp.Body)
	if err != nil {
		f.recordFailure(domain)
		return &PageContent{FetchError: fmt.Sprintf("Failed to parse HTML: %v", err)}, false, nil
	}

	content := &PageContent{
		Title:       extractTitle(doc),
		Description: extractDescription(doc, parsedURL.Host),
		Tags:        extractTags(doc),
	}

	f.recordSuccess(domain)
	return content, false, nil
}

func FetchPageContent(pageURL string) (*PageContent, bool, error) {
	return GetDefaultFetcher().FetchPageContent(pageURL)
}

func extractTitle(doc *html.Node) string {
	title := findTextContent(doc, "title")
	return strings.TrimSpace(title)
}

func extractDescription(doc *html.Node, host string) string {
	// Try standard meta description
	description := findMetaContent(doc, "name", "description")
	if description != "" {
		return strings.TrimSpace(description)
	}

	// Try Open Graph description
	description = findMetaContent(doc, "property", "og:description")
	if description != "" {
		return strings.TrimSpace(description)
	}

	// Special handling for known sites
	switch {
	case strings.Contains(host, "news.ycombinator.com"):
		description = extractHackerNewsDescription(doc)
	default:
		// For other sites, try to get the first paragraph or heading
		description = findFirstTextContent(doc, []string{"p", "h1", "h2"})
	}

	return strings.TrimSpace(description)
}

func extractHackerNewsDescription(doc *html.Node) string {
	title := findElementWithClass(doc, "td", "title")
	return strings.TrimSpace(title)
}

func extractTags(doc *html.Node) []string {
	var tags []string

	// Try to get tags from meta keywords
	keywords := findMetaContent(doc, "name", "keywords")
	if keywords != "" {
		tags = append(tags, strings.Split(keywords, ",")...)
	}

	// Try to get tags from meta tags
	metaTags := findMetaContent(doc, "name", "tags")
	if metaTags != "" {
		tags = append(tags, strings.Split(metaTags, ",")...)
	}

	// Clean and deduplicate tags
	uniqueTags := make(map[string]bool)
	for _, tag := range tags {
		tag = strings.TrimSpace(strings.ToLower(tag))
		if tag != "" {
			uniqueTags[tag] = true
		}
	}

	var cleanedTags []string
	for tag := range uniqueTags {
		cleanedTags = append(cleanedTags, tag)
	}

	return cleanedTags
}

func ValidateIfInternalIP(urlString string) bool {
	u, err := url.Parse(urlString)
	if err != nil {
		return false
	}

	host := u.Hostname()
	ip := net.ParseIP(host)
	if ip == nil {
		// If it's not a valid IP, try to resolve it
		ips, err := net.LookupIP(host)
		if err != nil || len(ips) == 0 {
			return false
		}
		ip = ips[0]
	}

	return ip.IsLoopback() || ip.IsPrivate()
}

func CheckSiteAvailability(urlStr string, timeout time.Duration) (bool, error) {
	u, err := url.Parse(urlStr)
	if err != nil {
		return false, fmt.Errorf("invalid URL: %w", err)
	}

	host := u.Hostname()
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}

	address := net.JoinHostPort(host, port)

	conn, err := net.DialTimeout("tcp", address, timeout)
	if err != nil {
		return false, nil // Site is unavailable, but it's not an error in our logic
	}
	defer conn.Close()

	return true, nil
}

func IsWebsiteAccessible(url string) (bool, error) {
	accessible, err := CheckSiteAvailability(url, 1*time.Second)
	if err != nil {
		return false, err
	}
	return accessible, nil
}

type WaybackResponse struct {
	ArchivedSnapshots struct {
		Closest struct {
			Available bool   `json:"available"`
			URL       string `json:"url"`
			Timestamp string `json:"timestamp"`
		} `json:"closest"`
	} `json:"archived_snapshots"`
}

func FetchMetadataFromWaybackMachine(urlStr string) (*PageContent, error) {
	// Construct the Wayback Machine API URL
	apiURL := fmt.Sprintf("https://archive.org/wayback/available?url=%s", url.QueryEscape(urlStr))

	// Create an HTTP client with a timeout
	client := &http.Client{Timeout: 10 * time.Second}

	// Make the request to the Wayback Machine API
	resp, err := client.Get(apiURL)
	if err != nil {
		return &PageContent{FetchError: fmt.Sprintf("failed to fetch Wayback Machine API: %v", err)}, nil
	}
	defer resp.Body.Close()

	// Read and parse the JSON response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return &PageContent{FetchError: fmt.Sprintf("failed to read Wayback Machine response: %v", err)}, nil
	}

	var waybackResp WaybackResponse
	err = json.Unmarshal(body, &waybackResp)
	if err != nil {
		return &PageContent{FetchError: fmt.Sprintf("failed to parse Wayback Machine response: %v", err)}, nil
	}

	// Check if an archived version is available
	if !waybackResp.ArchivedSnapshots.Closest.Available {
		return &PageContent{FetchError: "No archived version available"}, nil
	}

	// Fetch the archived page
	archivedResp, err := client.Get(waybackResp.ArchivedSnapshots.Closest.URL)
	if err != nil {
		return &PageContent{FetchError: fmt.Sprintf("failed to fetch archived page: %v", err)}, nil
	}
	defer archivedResp.Body.Close()

	// Parse the HTML
	doc, err := html.Parse(archivedResp.Body)
	if err != nil {
		return &PageContent{FetchError: fmt.Sprintf("Failed to parse HTML: %v", err)}, nil
	}

	// Extract title and description
	content := &PageContent{
		Title:       extractTitle(doc),
		Description: extractDescription(doc, urlStr),
		Tags:        extractTags(doc),
	}

	return content, nil
}

// Helper functions for HTML parsing without goquery

func findTextContent(doc *html.Node, tagName string) string {
	var result string
	var traverse func(*html.Node)
	traverse = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == tagName {
			if n.FirstChild != nil && n.FirstChild.Type == html.TextNode {
				result = n.FirstChild.Data
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if result != "" {
				return
			}
			traverse(c)
		}
	}
	traverse(doc)
	return result
}

func findMetaContent(doc *html.Node, attrName, attrValue string) string {
	var result string
	var traverse func(*html.Node)
	traverse = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "meta" {
			var hasAttr bool
			var content string
			for _, attr := range n.Attr {
				if attr.Key == attrName && attr.Val == attrValue {
					hasAttr = true
				}
				if attr.Key == "content" {
					content = attr.Val
				}
			}
			if hasAttr && content != "" {
				result = content
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if result != "" {
				return
			}
			traverse(c)
		}
	}
	traverse(doc)
	return result
}

func findFirstTextContent(doc *html.Node, tagNames []string) string {
	tagSet := make(map[string]bool)
	for _, tag := range tagNames {
		tagSet[tag] = true
	}
	
	var result string
	var traverse func(*html.Node)
	traverse = func(n *html.Node) {
		if n.Type == html.ElementNode && tagSet[n.Data] {
			text := getTextContent(n)
			if text != "" {
				result = text
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if result != "" {
				return
			}
			traverse(c)
		}
	}
	traverse(doc)
	return result
}

func findElementWithClass(doc *html.Node, tagName, className string) string {
	var result string
	var traverse func(*html.Node)
	traverse = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == tagName {
			for _, attr := range n.Attr {
				if attr.Key == "class" && attr.Val == className {
					result = getTextContent(n)
					return
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if result != "" {
				return
			}
			traverse(c)
		}
	}
	traverse(doc)
	return result
}

func getTextContent(n *html.Node) string {
	var text strings.Builder
	var traverse func(*html.Node)
	traverse = func(node *html.Node) {
		if node.Type == html.TextNode {
			text.WriteString(node.Data)
		}
		for c := node.FirstChild; c != nil; c = c.NextSibling {
			traverse(c)
		}
	}
	traverse(n)
	return strings.TrimSpace(text.String())
}
