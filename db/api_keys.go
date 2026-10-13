package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

type APIKey struct {
	ID        int64      `json:"id"`
	Owner     string     `json:"owner"`
	Name      string     `json:"name"`
	Scopes    []string   `json:"scopes"`
	CreatedAt time.Time  `json:"created_at"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	RevokedAt *time.Time `json:"revoked_at,omitempty"`
}

func (d *DB) CreateAPIKey(ctx context.Context, hash, owner, name string, scopes []string, expires *time.Time) (*APIKey, error) {
	k := &APIKey{Owner: owner, Name: name, Scopes: scopes, ExpiresAt: expires}
	err := d.QueryRowContext(ctx, `INSERT INTO api_keys(token_hash,owner,name,scopes,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at`, hash, owner, name, scopes, expires).Scan(&k.ID, &k.CreatedAt)
	return k, err
}

func scanAPIKey(row interface{ Scan(...any) error }) (*APIKey, error) {
	k := new(APIKey)
	var scopes string
	err := row.Scan(&k.ID, &k.Owner, &k.Name, &scopes, &k.CreatedAt, &k.ExpiresAt, &k.RevokedAt)
	if err == nil {
		err = json.Unmarshal([]byte(scopes), &k.Scopes)
	}
	return k, err
}

func (d *DB) AuthenticateAPIKey(ctx context.Context, hash string) (*APIKey, error) {
	k, err := scanAPIKey(d.QueryRowContext(ctx, `SELECT id,owner,name,array_to_json(scopes)::text,created_at,expires_at,revoked_at FROM api_keys WHERE token_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`, hash))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return k, err
}

func (d *DB) ListAPIKeys(ctx context.Context, owner string) ([]*APIKey, error) {
	rows, err := d.QueryContext(ctx, `SELECT id,owner,name,array_to_json(scopes)::text,created_at,expires_at,revoked_at FROM api_keys WHERE owner=$1 ORDER BY id DESC`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := make([]*APIKey, 0)
	for rows.Next() {
		k, err := scanAPIKey(rows)
		if err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func (d *DB) RevokeAPIKey(ctx context.Context, id int64, owner string) (bool, error) {
	result, err := d.ExecContext(ctx, `UPDATE api_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND owner=$2`, id, owner)
	if err != nil {
		return false, err
	}
	n, err := result.RowsAffected()
	return n > 0, err
}

func (d *DB) OwnedTaskIDs(ctx context.Context, owner string) (map[string]bool, error) {
	rows, err := d.QueryContext(ctx, `SELECT id::text FROM tasks WHERE owner=$1`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids[id] = true
	}
	return ids, rows.Err()
}

func (d *DB) TaskOwnedBy(ctx context.Context, id, owner string) (bool, error) {
	var exists bool
	err := d.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM tasks WHERE id::text=$1 AND owner=$2)`, id, owner).Scan(&exists)
	return exists, err
}
