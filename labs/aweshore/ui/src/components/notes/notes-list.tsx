// src/components/notes-list.tsx
import {component$, useStore, useResource$, Resource, $} from '@builder.io/qwik';
import * as api from '../../services/api';
import 'bulma/css/bulma.min.css';
import {toast} from 'bulma-toast';

export interface Note {
    id: number;
    title: string;
    content: string;
    noteTypeId: number; // Corresponds to NoteTypeID in the Go struct
    created: string; // Consider if you need to adjust this to Date for consistency with your BE or keep as string for direct JSON mapping
    updated: string; // Same consideration as for `created`
    status: string; // Corresponds to Status in the Go struct
}

export const NotesList = component$(() => {
    const store = useStore({
        notes: [] as Note[],
        currentPage: 1,
        pageSize: 10,
        totalPages: 0,
        totalCount: 0,
        lastId: 0,
        newNote: {title: '', content: ''} as Note,
        loading: false,
    });

    const fetchNotes = $(async () => {
        store.loading = true; // Start loading
        try{
            const {notes, totalPages, totalCount, lastId} = await api.getNotes(store.currentPage, store.pageSize);
            store.notes = notes;
            store.totalPages = totalPages;
            store.totalCount = totalCount;
            store.lastId = lastId;
        } catch (error) {
            console.error('Failed to fetch notes:', error);
            showToast('Failed to load notes');
        } finally {
            store.loading = false; // Stop loading regardless of success or failure
        }
    });

    const notesResource = useResource$<Note[]>(async ({track}) => {
        track(() => store.currentPage);
        track(() => store.pageSize);
        track(() => store.totalCount);

        const {notes, totalCount, totalPages} = await api.getNotes(store.currentPage, store.pageSize);
        store.notes = notes;
        store.loading = false;
        store.totalCount = totalCount;
        store.totalPages = totalPages;
        return notes;
    });

    const updateNote = $(async (note: Note) => {
        try {
            await api.updateNote(note.id, note.title, note.content);
            // Optionally refresh the list or show a success message
        } catch (error) {
            showToast('Update note failed')
            console.error('Failed to update note:', error);
        }
    });

    const deleteNote = $(async (id: number) => {
        try {
            await api.deleteNote(id);
            store.notes = store.notes.filter((note) => note.id !== id);
        } catch (error) {
            showToast('Delete note failed')
            console.error('Failed to delete note:', error);
        }
    });

    const addNote = $(async () => {
        if (!store.newNote.title || !store.newNote.content) {
            console.error('Title and content are required.');
            return;
        }
        const newNote = await api.createNote(store.newNote.title, store.newNote.content);
        // Ensure the new note has all the necessary properties, including the ID from the database.
        if (newNote && newNote.id > 0) {
            store.notes = [...store.notes, newNote];
        } else {
            // show a showToast to user, create note failed
            showToast('Create note failed');
            console.error('Failed to create note:', newNote);
        }
        // Reset the new note form fields.
        store.newNote.title = '';
        store.newNote.content = '';
    });

    const formatDate = (dateString: string): string => {
        const date = new Date(dateString);
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Months are 0-indexed, so +1 is needed
        const day = date.getDate().toString().padStart(2, '0');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');

        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    const showToast = $((msg: string) => {
        toast({
            message: msg,
            type: 'is-danger',
            dismissible: true,
            pauseOnHover: true,
            duration: 5500,
            position: 'top-center',
        });
    });
    
    return (
        <div>
            <div class="table-container">
                <div class="level-left">
                    <Resource value={notesResource} onResolved={() => (
                        <div class="level-item">
                            <div class="tags has-addons">
                                <span class="tag is-dark">Total Notes</span>
                                <span class="tag is-info">{store.totalCount.toLocaleString()}</span>
                            </div>
                        </div>
                    )}/>
                    <Resource value={notesResource} onResolved={() => (
                        <div class="level-item">
                            <div class="tags has-addons">
                                <span class="tag is-dark">Total Pages</span>
                                <span class="tag is-primary">{store.totalPages.toLocaleString()}</span>
                            </div>
                        </div>
                    )}/>
                </div>
                <div class="level-right">
                    <div class="level-item">
                        {(
                            <button class="button is-link is-light" disabled={store.loading} onClick$={() => {
                                if (store.currentPage > store.totalPages) {
                                    store.currentPage = store.totalPages;
                                }
                                if (store.currentPage > 1) {
                                    store.currentPage = store.currentPage - 1;
                                }
                                fetchNotes();
                            }}>Last</button>
                        )}
                    </div>

                    <div class="level-item">
                        <input
                            class="input"
                            type="number"
                            value={store.currentPage}
                            onInput$={(e) => (store.currentPage = parseInt((e.target as HTMLInputElement).value))}
                            placeholder="Page Number"
                        />
                    </div>

                    <div class="level-item">
                        <input
                            class="input"
                            type="number"
                            value={store.pageSize}
                            onInput$={(e) => (store.pageSize = parseInt((e.target as HTMLInputElement).value))}
                            placeholder="Page Size"
                        />
                    </div>

                    <div class="level-item">
                        <button class="button is-link" disabled={store.loading} onClick$={() => fetchNotes()}>Go</button>
                    </div>

                    <div class="level-item">
                        {(
                            <button class="button is-link is-light" disabled={store.loading} onClick$={() => {
                                if (store.currentPage > store.totalPages) {
                                    store.currentPage = store.totalPages;
                                }
                                if (store.currentPage < store.totalPages) {
                                    store.currentPage = store.currentPage + 1;
                                }
                                fetchNotes();
                            }}>Next</button>
                        )}
                    </div>
                </div>
                <table class="table is-fullwidth is-hoverable is-striped">
                    <thead>
                    <tr>
                        <th>ID</th>
                        <th>Title</th>
                        <th>Content</th>
                        <th>Created</th>
                        <th>Updated</th>
                        <th>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    <Resource value={notesResource} onResolved={() => (
                        store.notes.map((note) => (
                            <tr key={note.id}>
                                <td>{note.id}</td>
                                <td>
                                    <input
                                        class="input"
                                        type="text"
                                        value={note.title}
                                        onInput$={(e) => (note.title = (e.target as HTMLInputElement).value)}
                                    />
                                </td>
                                <td>
                  <textarea
                      class="textarea"
                      value={note.content}
                      onInput$={(e) => (note.content = (e.target as HTMLTextAreaElement).value)}
                  ></textarea>
                                </td>
                                <td>{formatDate(note.created)}</td>
                                <td>{formatDate(note.updated)}</td>
                                <td>
                                    <button class="button is-small is-success" disabled={store.loading}
                                            onClick$={() => updateNote(note)}>Save
                                    </button>
                                    <button class="button is-small is-danger" disabled={store.loading}
                                            onClick$={() => deleteNote(note.id)}>Delete
                                    </button>
                                </td>
                            </tr>
                        ))
                    )}/>
                    {/* Add new note row */}
                    <tr>
                        <td></td>
                        {/* Empty cell for the ID */}
                        <td>
                            <input
                                class="input"
                                type="text"
                                placeholder="Title"
                                value={store.newNote.title}
                                onInput$={(e) => (store.newNote.title = (e.target as HTMLInputElement).value)}
                            />
                        </td>
                        <td> {/* Merge cells for content textarea */}
                            <textarea
                                class="textarea"
                                placeholder="Content"
                                value={store.newNote.content}
                                onInput$={(e) => (store.newNote.content = (e.target as HTMLTextAreaElement).value)}
                            ></textarea>
                        </td>
                        <td></td>
                        <td></td>
                        {/* Empty cells for Created and Updated dates */}
                        <td>
                            <button class="button is-primary" disabled={store.loading} onClick$={addNote}>Add Note</button>
                        </td>
                    </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
});
