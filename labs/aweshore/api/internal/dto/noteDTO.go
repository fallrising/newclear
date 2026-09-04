package dto

type NoteDTO struct {
	ID         int    `json:"id"`
	Title      string `json:"title"`
	Content    string `json:"content"`
	NoteTypeID int    `json:"noteTypeId"` // Example of adjusting field name for JSON
	Created    string `json:"created"`    // Using string here to possibly format dates differently
	Updated    string `json:"updated"`
	Status     string `json:"status"`
}
