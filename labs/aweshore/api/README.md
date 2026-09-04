# AweShore
## Requirements
1. Local Personalized Avatar LLM with Vector Database:
  * Integrating a local, personalized avatar LLM with a vector database is an ambitious goal. It will require significant effort to train and fine-tune the LLM model with your notes data.
  * Vector databases like Weaviate, Pinecone, or Milvus can be used to store and retrieve notes efficiently using semantic search.
2. Pure Notes Mode and Default Notes Mode:
  * The distinction between pure notes mode and default notes mode is a helpful feature for focusing on writing or exploring related information.
  * To enable this, you may need additional tables or fields in your database to store metadata about note types or modes.
3. Customized Crawlers and AI Note Generation:
  * Building customized crawlers to generate summarized notes from various sources (Reddit, Twitter, PTT, Dcard) using AI models like ChatGPT can greatly enhance the note-taking experience.
  * You may need to create additional tables to store metadata about the crawlers, sources, and AI-generated notes.
4. Zapier or n8n Integration:
  * Integrating with services like Zapier or n8n can automate various actions based on note creation or updates, such as data backups or notifications.
  * You may need to store API keys or configuration data for these services in your database.
5. Notes View Mode:
  * The ability to combine specific notes into different views (todo, calendar, learning topics) is a powerful feature.
  * You may need to create additional tables or fields to store metadata about note views or tags that can be used for filtering and grouping.
6. Simple and Advanced Modes:
  * Providing both simple and advanced modes can cater to users with different levels of technical expertise.
  * You may need to store user preferences or configurations to enable these modes.
7. Storing User Data in SQLite Files:
  * The idea of using SQLite files for each "user" (e.g., Six Thinking Hats) is an interesting approach, but it may introduce complexity in managing and querying data across multiple files.
  * You may want to consider storing all data in a single database and using a "user" or "context" field to differentiate between different categories or personas.
8. Additional Suggestions:
  * Consider adding fields or tables to store metadata about note sources (e.g., URLs, authors, publication dates) for better organization and attribution.
  * Implement a full-text search feature to allow users to search within note contents efficiently.
  * Explore integrating with cloud storage services (e.g., Dropbox, Google Drive) for backup and synchronization purposes.
  * Implement user authentication and authorization mechanisms to ensure data security and privacy.

## Entity
``` @startuml
!theme plain

entity "users" as users {
+ id : INTEGER
  --
  username : TEXT
  email : TEXT
  password : TEXT
  created : DATETIME
  updated : DATETIME
  status : TEXT
  }

entity "notes" as notes {
+ id : INTEGER
  --
  title : TEXT
  content : TEXT
  note_type_id : INTEGER
  created : DATETIME
  updated : DATETIME
  status : TEXT
  }

entity "attachments" as attachments {
+ id : INTEGER
  --
  title : TEXT
  file_link : TEXT
  created : DATETIME
  updated : DATETIME
  status : TEXT
  }

entity "tags" as tags {
+ id : INTEGER
  --
  tag_name : TEXT
  created : DATETIME
  updated : DATETIME
  status : TEXT
  }

entity "note_types" as note_types {
+ id : INTEGER
  --
  type_name : TEXT
  description : TEXT
  status : TEXT
  }

entity "versioned_notes" as versioned_notes {
+ id : INTEGER
  --
  title : TEXT
  content : TEXT
  note_type_id : INTEGER
  note_id : INTEGER
  created : DATETIME
  updated : DATETIME
  status : TEXT
  }

entity "notes_attachments" as notes_attachments {
+ note_id : INTEGER
+ attachment_id : INTEGER
  }

entity "notes_tags" as notes_tags {
+ note_id : INTEGER
+ tag_id : INTEGER
  }

entity "user_notes" as user_notes {
+ id : INTEGER
  --
  user_id : INTEGER
  note_id : INTEGER
  created_at : DATETIME
  }

notes ||--o{ versioned_notes : "versioned"
notes }o--|| note_types : "type"
notes ||--o{ notes_attachments : "has"
notes ||--o{ notes_tags : "tagged"
attachments ||--o{ notes_attachments : "attached to"
tags ||--o{ notes_tags : "tags"
users ||--o{ user_notes : "has"
notes ||--o{ user_notes : "has"
@enduml
```
## DDL
```-- users table
CREATE TABLE users (
id INTEGER PRIMARY KEY AUTOINCREMENT,
username TEXT NOT NULL,
email TEXT NOT NULL,
password TEXT NOT NULL,
created DATETIME NOT NULL,
updated DATETIME NOT NULL,
status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted'))
);

-- notes table
CREATE TABLE notes (
id INTEGER PRIMARY KEY AUTOINCREMENT,
title TEXT,
content TEXT,
note_type_id INTEGER,
created DATETIME NOT NULL,
updated DATETIME NOT NULL,
status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted'))
);

-- attachments table
CREATE TABLE attachments (
id INTEGER PRIMARY KEY AUTOINCREMENT,
title TEXT,
file_link TEXT,
created DATETIME NOT NULL,
updated DATETIME NOT NULL,
status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted'))   
);

-- tags table
CREATE TABLE tags (
id INTEGER PRIMARY KEY AUTOINCREMENT,
tag_name TEXT NOT NULL,
created DATETIME NOT NULL,
updated DATETIME NOT NULL,
status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted'))    
);

-- note_types table
CREATE TABLE note_types (
id INTEGER PRIMARY KEY AUTOINCREMENT,
type_name TEXT NOT NULL,
description TEXT,
status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted'))   
);

-- versioned_notes table
CREATE TABLE versioned_notes (
id INTEGER PRIMARY KEY AUTOINCREMENT,
title TEXT,
content TEXT,
note_type_id INTEGER,
note_id INTEGER NOT NULL,
created DATETIME NOT NULL,
updated DATETIME NOT NULL,
status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted'))
);

-- notes_attachments table
CREATE TABLE notes_attachments (
note_id INTEGER NOT NULL,
attachment_id INTEGER NOT NULL,
PRIMARY KEY (note_id, attachment_id)
);

-- notes_tags table
CREATE TABLE notes_tags (
note_id INTEGER NOT NULL,
tag_id INTEGER NOT NULL,
PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE user_notes (
id INTEGER PRIMARY KEY AUTOINCREMENT,
user_id INTEGER NOT NULL,
note_id INTEGER NOT NULL,
created_at DATETIME NOT NULL,  -- Example of additional metadata
);```