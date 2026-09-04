package handler

import (
	"aweshore/internal/dto"
	"aweshore/internal/model"
	"aweshore/internal/store"
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
	"time"
)

// noteStore will be our interface to the notes storage.
var noteStore store.NoteStore

func GetNoteStore() store.NoteStore {
	if noteStore == nil {
		noteStore = store.NewNoteStore()
	}
	return noteStore
}

// CreateNote handles POST requests to create a new note
func CreateNote(c *gin.Context) {
	var note model.Note
	if err := c.ShouldBindJSON(&note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id, err := GetNoteStore().Create(note)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	savedNote, err := GetNoteStore().GetByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, savedNote)
}

// GetNote handles GET requests to retrieve a note by its ID
func GetNote(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	note, err := GetNoteStore().GetByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, note)
}

func GetPaginatedNotes(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "10"))

	var lastId int64
	var err error
	var totalCount int
	var totalPages int

	totalCount, err = GetNoteStore().Count()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch total notes count"})
		return
	}

	totalPages = (totalCount + pageSize - 1) / pageSize // Calculate total pages

	if page < 1 {
		page = 1
	} else if page > totalPages {
		page = totalPages
	}

	if page != 1 {
		offset := (page - 1) * pageSize
		lastId, err = GetNoteStore().GetLastIdByOffset(offset)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to calculate last ID"})
			return
		}
	} else {
		lastId = 0
	}

	notes, err := GetNoteStore().GetPaginated(lastId, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// build a slice of NoteDTO
	var notesDTO []dto.NoteDTO
	// iterate over notes and convert each note to NoteDTO
	for _, note := range notes {
		notesDTO = append(notesDTO, NoteToDTO(note))
	}

	c.JSON(http.StatusOK, gin.H{
		"notes":       notesDTO,
		"totalPages":  totalPages,
		"currentPage": page,
		"pageSize":    pageSize,
		"totalCount":  totalCount,
		"lastId":      lastId,
	})
}

// GetAllNotes handles GET requests to retrieve all notes
func GetAllNotes(c *gin.Context) {
	notes, err := GetNoteStore().GetAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, notes)
}

// UpdateNote handles PUT requests to update an existing note
func UpdateNote(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var note model.Note
	if err := c.ShouldBindJSON(&note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err = GetNoteStore().Update(id, note)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Note updated successfully"})
}

// DeleteNote handles DELETE requests to remove a note
func DeleteNote(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	err = GetNoteStore().Delete(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Note deleted successfully"})
}

func NoteToDTO(note model.Note) dto.NoteDTO {
	return dto.NoteDTO{
		ID:         note.ID,
		Title:      note.Title,
		Content:    note.Content,
		NoteTypeID: note.NoteTypeID,
		Created:    note.Created.Format(time.RFC3339),
		Updated:    note.Updated.Format(time.RFC3339),
		Status:     note.Status,
	}
}
