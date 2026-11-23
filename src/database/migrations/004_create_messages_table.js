// Mensagens do chat: quem mandou (ip e name), o texto (message) e quando (date).
// Quem grava é o job SaveMessageJob, na fila save-message, e não o websocket.
export async function up(db) {
  await db.query(`
    CREATE TABLE messages (
      id SERIAL PRIMARY KEY,
      ip VARCHAR(45) NOT NULL,
      name VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

export async function down(db) {
  await db.query(`
    DROP TABLE messages
  `)
}
