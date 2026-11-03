CREATE TABLE opportunities (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, whatsapp TEXT,
 project_type TEXT NOT NULL, area TEXT, budget TEXT, description TEXT NOT NULL,
 received_at TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'novo'
 CHECK(status IN ('novo','em_conversa','proposta_enviada','ganho','perdido','arquivado')),
 next_contact TEXT, notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
CREATE INDEX opportunities_received ON opportunities(received_at);
CREATE INDEX opportunities_followup ON opportunities(next_contact);
CREATE TABLE opportunity_receipts (id TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
