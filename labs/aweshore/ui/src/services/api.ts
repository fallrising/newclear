const API_BASE_URL = 'http://localhost:8080'; // Update this to your Go backend URL

export const getNotes = async (page = 1, pageSize = 10) => {
    const response = await fetch(`${API_BASE_URL}/notes?page=${page}&pageSize=${pageSize}`);
    if (!response.ok) {
        throw new Error('Failed to fetch notes');
    }
    return response.json();
};

export const getNoteById = async (id: string) => {
    const response = await fetch(`${API_BASE_URL}/notes/${id}`);
    if (!response.ok) {
        throw new Error('Failed to fetch note');
    }
    return response.json();
};

export const createNote = async (title: string, content: string) => {
    const response = await fetch(`${API_BASE_URL}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
    });
    if (!response.ok) {
        throw new Error('Failed to create note');
    }
    return response.json();
};

export const updateNote = async (id: number, title: string, content: string) => {
    const response = await fetch(`${API_BASE_URL}/notes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
    });
    if (!response.ok) {
        throw new Error('Failed to update note');
    }
    return response.json();
};

export const deleteNote = async (id: number) => {
    const response = await fetch(`${API_BASE_URL}/notes/${id}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        throw new Error('Failed to delete note');
    }
    return response.json();
};