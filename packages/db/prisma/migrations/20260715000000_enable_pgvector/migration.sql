-- Habilita pgvector. Los embeddings del catálogo llegan en US-005; la extensión
-- se instala desde el bootstrap para que el esquema sea idéntico en local y nube.
CREATE EXTENSION IF NOT EXISTS vector;
