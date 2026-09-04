package store

import (
	"aweshore/internal/model"
	"aweshore/pkg/db"
	"database/sql"
	"time"
)

// TagStore interface defines the CRUD operations for tags
type TagStore interface {
	Create(tag model.Tag) (int64, error)
	GetByID(id int64) (*model.Tag, error)
	GetAll() ([]model.Tag, error)
	Update(id int64, tag model.Tag) error
	Delete(id int64) error
}

type tagStore struct {
	db *sql.DB
}

// NewTagStore creates a new instance of tagStore
func NewTagStore() TagStore {
	if db.DB == nil {
		panic("db.DB is nil. Ensure db.Init() has been called before creating a new TagStore.")
	}
	return &tagStore{
		db: db.DB,
	}
}

// Create inserts a new tag into the database
func (s *tagStore) Create(tag model.Tag) (int64, error) {
	statement, err := s.db.Prepare("INSERT INTO tags (tag_name, created, updated, status) VALUES (?, ?, ?, ?)")
	if err != nil {
		return 0, err
	}
	defer statement.Close()

	result, err := statement.Exec(tag.TagName, time.Now(), time.Now(), tag.Status)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

// GetByID retrieves a tag by its ID from the database
func (s *tagStore) GetByID(id int64) (*model.Tag, error) {
	tag := &model.Tag{}
	err := s.db.QueryRow("SELECT id, tag_name, created, updated, status FROM tags WHERE id = ?", id).Scan(&tag.ID, &tag.TagName, &tag.Created, &tag.Updated, &tag.Status)
	if err != nil {
		return nil, err
	}
	return tag, nil
}

// GetAll retrieves all tags from the database
func (s *tagStore) GetAll() ([]model.Tag, error) {
	rows, err := s.db.Query("SELECT id, tag_name, created, updated, status FROM tags")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []model.Tag
	for rows.Next() {
		var t model.Tag
		if err := rows.Scan(&t.ID, &t.TagName, &t.Created, &t.Updated, &t.Status); err != nil {
			return nil, err
		}
		tags = append(tags, t)
	}
	if tags == nil {
		tags = make([]model.Tag, 0)
	}
	return tags, nil
}

// Update modifies an existing tag's details in the database
func (s *tagStore) Update(id int64, tag model.Tag) error {
	_, err := s.db.Exec("UPDATE tags SET tag_name = ?, updated = ?, status = ? WHERE id = ?", tag.TagName, time.Now(), tag.Status, id)
	return err
}

// Delete removes a tag from the database
func (s *tagStore) Delete(id int64) error {
	_, err := s.db.Exec("DELETE FROM tags WHERE id = ?", id)
	return err
}
