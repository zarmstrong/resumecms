import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getSetting } from '../db.js';

const router = Router();
const DATA_DIR = process.env.RESUMECMS_DATA_DIR || '/data';
export const PDF_PATH = path.join(DATA_DIR, 'resume.pdf');

router.get('/resume.pdf', (req, res) => {
  if (!fs.existsSync(PDF_PATH)) {
    return res.status(404).json({ error: 'No PDF has been published yet' });
  }

  const published = getSetting('published_resume') || {};
  const site = published.site || {};
  const fileName = `${(site.title || 'resume').replace(/[^a-z0-9-_]+/gi, '-')}.pdf`;

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${fileName}"`,
  });
  res.sendFile(PDF_PATH);
});

export default router;
