import { useState, useCallback } from 'react';
import { sqliteManager } from '../offline/db/SQLiteManager';
import * as Crypto from 'expo-crypto';

export const useFormDrafts = () => {
  const saveDraft = async (templateId: string, data: any, draftId?: string) => {
    const id = draftId || Crypto.randomUUID();
    const now = new Date().toISOString();
    await sqliteManager.execute(
      `INSERT OR REPLACE INTO form_drafts (id, template_id, form_data, last_updated) VALUES (?, ?, ?, ?)`,
      [id, templateId, JSON.stringify(data), now]
    );
    return id;
  };

  const loadDrafts = async (templateId: string) => {
    return await sqliteManager.query<any>(
      `SELECT * FROM form_drafts WHERE template_id = ? ORDER BY last_updated DESC`,
      [templateId]
    );
  };

  const deleteDraft = async (id: string) => {
    await sqliteManager.execute(`DELETE FROM form_drafts WHERE id = ?`, [id]);
  };

  return { saveDraft, loadDrafts, deleteDraft };
};