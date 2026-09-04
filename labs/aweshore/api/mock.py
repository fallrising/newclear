import sqlite3
import random
from datetime import datetime
import time

# Database connection details
db_file = 'aweshore.db'

# Function to generate random data
def generate_random_data():
    title = ''.join(random.choice('abcdefghijklmnopqrstuvwxyz') for _ in range(10))
    content = ''.join(random.choice('abcdefghijklmnopqrstuvwxyz ') for _ in range(200))
    created = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    updated = created
    return title, content, created, updated

# Main script
if __name__ == '__main__':
    start_time = time.time()

    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()

        # Prepare the SQL statement for efficiency
        insert_sql = '''
            INSERT INTO notes (title, content, created, updated)
            VALUES (?, ?, ?, ?)
        '''

        # Batch size for transaction optimization
        batch_size = 5000
        data_batch = []

        # Generate and insert 1 million records
        for _ in range(10000000):
            data = generate_random_data()
            data_batch.append(data)

            if len(data_batch) == batch_size:
                cursor.executemany(insert_sql, data_batch)
                conn.commit()  # Commit changes after each batch
                data_batch = []  # Reset the batch

        # Insert any remaining data
        if data_batch:
            cursor.executemany(insert_sql, data_batch)
            conn.commit()

    end_time = time.time()
    print(f"Inserted 1 million records in {end_time - start_time:.2f} seconds")
