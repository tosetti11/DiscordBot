-- Table for tracking tailed bets
create table if not exists tailed_bets (
    id uuid primary key default gen_random_uuid(),
    bet_id uuid references bets(id) on delete cascade,
    tailer_discord_id text not null,
    tailed_at timestamptz default now(),
    tailed boolean not null, -- true for Yes, false for No
    unique (bet_id, tailer_discord_id)
);

-- Index for fast lookup
create index if not exists idx_tailed_bets_bet_id on tailed_bets(bet_id);
create index if not exists idx_tailed_bets_tailer on tailed_bets(tailer_discord_id);
