-- v2 W5: GET /api/agents/:id/generations lists one agent's generations newest first (B-09).
-- The v1 index generations_room_agent(room_id, agent_id, created_at) cannot serve a query without room_id.
CREATE INDEX generations_agent_created ON generations(agent_id, created_at);
