package store

import (
	"aweshore/internal/model"
	"aweshore/pkg/db"
	"database/sql"
	"time"
)

// UserStore interface defines the CRUD operations for users
type UserStore interface {
	Create(user model.User) (int64, error)
	GetByID(id int64) (*model.User, error)
	GetAll() ([]model.User, error)
	Update(id int64, user model.User) error
	Delete(id int64) error
}

type userStore struct {
	db *sql.DB
}

// NewUserStore creates a new instance of userStore
func NewUserStore() UserStore {
	if db.DB == nil {
		panic("db.DB is nil. Ensure db.Init() has been called before creating a new UserStore.")
	}
	return &userStore{
		db: db.DB,
	}
}

// Create inserts a new user into the database
func (s *userStore) Create(user model.User) (int64, error) {
	statement, err := s.db.Prepare("INSERT INTO users (username, email, password, created, updated, status) VALUES (?, ?, ?, ?, ?, ?)")
	if err != nil {
		return 0, err
	}
	defer statement.Close()

	result, err := statement.Exec(user.Username, user.Email, user.Password, time.Now(), time.Now(), user.Status)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

// GetByID retrieves a user by their ID from the database
func (s *userStore) GetByID(id int64) (*model.User, error) {
	user := &model.User{}
	err := s.db.QueryRow("SELECT id, username, email, password, created, updated, status FROM users WHERE id = ?", id).Scan(&user.ID, &user.Username, &user.Email, &user.Password, &user.Created, &user.Updated, &user.Status)
	if err != nil {
		return nil, err
	}
	return user, nil
}

// GetAll retrieves all users from the database
func (s *userStore) GetAll() ([]model.User, error) {
	rows, err := s.db.Query("SELECT id, username, email, password, created, updated, status FROM users")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []model.User
	for rows.Next() {
		var u model.User
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.Password, &u.Created, &u.Updated, &u.Status); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	if users == nil {
		users = make([]model.User, 0)
	}
	return users, nil
}

// Update modifies an existing user's details in the database
func (s *userStore) Update(id int64, user model.User) error {
	_, err := s.db.Exec("UPDATE users SET username = ?, email = ?, password = ?, updated = ?, status = ? WHERE id = ?", user.Username, user.Email, user.Password, time.Now(), user.Status, id)
	return err
}

// Delete removes a user from the database
func (s *userStore) Delete(id int64) error {
	_, err := s.db.Exec("DELETE FROM users WHERE id = ?", id)
	return err
}
