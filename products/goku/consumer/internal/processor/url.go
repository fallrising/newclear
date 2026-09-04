package processor

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/fallrising/goku-consumer/internal/api"
	"github.com/fallrising/goku-consumer/pkg/models"
)

type Message struct {
	MessageType string   `json:"messageType"`
	URLs        []string `json:"urls,omitempty"`
	FileType    string   `json:"fileType,omitempty"`
	FileURL     string   `json:"fileUrl,omitempty"`
	FileName    string   `json:"fileName,omitempty"`
}

func ProcessURL(urlString string) (*models.URLInfo, error) {
	parsedURL, err := url.Parse(urlString)
	if err != nil {
		return nil, fmt.Errorf("failed to parse URL: %w", err)
	}

	if parsedURL.Host == "api.telegram.org" {
		return &models.URLInfo{
			URL:         urlString,
			Title:       "TG BOT",
			Description: "last 4 digits of identity number;",
			Tags:        []string{},
		}, nil
	}

	client := &http.Client{
		Timeout: 1500 * time.Millisecond,
	}

	req, err := http.NewRequest("GET", urlString, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", "GokuConsumer/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	// Limit the response body to 1MB to prevent excessive memory usage
	bodyReader := io.LimitReader(resp.Body, 1024*1024)

	doc, err := goquery.NewDocumentFromReader(bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to parse HTML: %w", err)
	}

	title := strings.TrimSpace(doc.Find("title").First().Text())
	description := strings.TrimSpace(doc.Find("meta[name=description]").AttrOr("content", ""))

	var tags []string
	doc.Find("meta[name=keywords]").Each(func(i int, s *goquery.Selection) {
		content, _ := s.Attr("content")
		for _, tag := range strings.Split(content, ",") {
			tag = strings.TrimSpace(tag)
			if tag != "" {
				tags = append(tags, tag)
			}
		}
	})

	return &models.URLInfo{
		URL:         urlString,
		Title:       title,
		Description: description,
		Tags:        tags,
	}, nil
}

func ProcessMessage(msg []byte, apiClient *api.Client) error {
	var message Message
	if err := json.Unmarshal(msg, &message); err != nil {
		return err
	}

	var urls []string
	switch message.MessageType {
	case "url":
		urls = message.URLs
	case "file":
		urls = []string{message.FileURL}
	default:
		log.Printf("Unknown message type: %s", message.MessageType)
		return nil
	}

	var batch []models.URLInfo
	for _, targetURL := range urls {
		info, err := ProcessURL(targetURL)
		if err != nil {
			log.Printf("Error processing URL %s: %v", targetURL, err)
			continue
		}
		batch = append(batch, *info)

		if len(batch) >= 10 {
			if err := apiClient.UploadBatch(batch); err != nil {
				log.Printf("Error uploading batch: %v", err)
			}
			batch = batch[:0]
		}
	}

	if len(batch) > 0 {
		if err := apiClient.UploadBatch(batch); err != nil {
			log.Printf("Error uploading final batch: %v", err)
		}
	}

	return nil
}
