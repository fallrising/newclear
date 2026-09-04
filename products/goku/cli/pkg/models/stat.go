package models

type Statistics struct {
	HostnameCounts      map[string]int
	TagCounts           map[string]int
	LatestBookmarks     []*Bookmark
	AccessibilityCounts map[string]int
	TopHostnames        []HostnameCount
	UniqueHostnames     []string
	CreatedLastWeek     map[string]int
}

type HostnameCount struct {
	Hostname string
	Count    int
}
