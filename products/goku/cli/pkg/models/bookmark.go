package models

import (
	"strings"
	"time"
)

type Bookmark struct {
	ID          int64     `json:"id"`
	URL         string    `json:"url"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Tags        []string  `json:"tags"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (b *Bookmark) AddTag(tag string) {
	tag = strings.TrimSpace(strings.ToLower(tag))
	if tag == "" {
		return
	}

	for _, t := range b.Tags {
		if t == tag {
			return // Tag already exists
		}
	}
	b.Tags = append(b.Tags, tag)
}

func (b *Bookmark) RemoveTag(tag string) {
	for i, t := range b.Tags {
		if t == tag {
			// Remove the tag from the list
			b.Tags = append(b.Tags[:i], b.Tags[i+1:]...)
			return
		}
	}
}
