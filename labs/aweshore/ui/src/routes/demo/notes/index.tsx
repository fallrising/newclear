import { component$ } from '@builder.io/qwik';
import {NotesList} from "~/components/notes/notes-list";


export default component$(() => {
    return (
        <div>
            <NotesList />
        </div>
    );
});