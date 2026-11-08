import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envText = fs.readFileSync('.env', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) env[match[1]] = match[2].trim();
}

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const qs = JSON.parse(fs.readFileSync('scratch/ch3_open_dataset_clean.json', 'utf8'));

async function main() {
  console.log(`Connecting to Supabase at ${env.VITE_SUPABASE_URL}...`);
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: env.IMPORT_ADMIN_EMAIL,
    password: env.IMPORT_ADMIN_PASSWORD,
  });
  if (authErr) throw authErr;
  console.log(`Authenticated as ${auth.user.email} (ID: ${auth.user.id})`);

  // 1. Upload images
  console.log('\n--- 1. Uploading images to question-images bucket ---');
  const imgFiles = fs.readdirSync('scratch/upload_images');
  for (const imgName of imgFiles) {
    const buf = fs.readFileSync(`scratch/upload_images/${imgName}`);
    const storagePath = `questions/${imgName}`;
    const contentType = imgName.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    const { error: upErr } = await supabase.storage
      .from('question-images')
      .upload(storagePath, buf, { contentType, upsert: true });

    if (upErr) {
      console.error(`Error uploading ${storagePath}:`, upErr);
      throw upErr;
    }
    console.log(`Uploaded ${storagePath} (${buf.length} bytes)`);
  }

  // 2. Check if open questions already exist in Chapter 3
  const ch3Id = 'f5d12c8a-6a11-48ca-b09d-98a202e96f99';
  const { count: existingCount, error: countErr } = await supabase
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('chapter_id', ch3Id)
    .eq('type', 'open')
    .eq('is_deleted', false);

  if (countErr) throw countErr;
  console.log(`\nExisting open questions in Chapter 3: ${existingCount || 0}`);

  // 3. Create import batch
  const batchName = `Импорт открытых вопросов по биологии (Глава 3, ${qs.length} вопр.)`;
  const { data: batch, error: batchErr } = await supabase
    .from('import_batches')
    .insert({
      created_by: auth.user.id,
      filename: batchName,
      items_count: qs.length,
    })
    .select()
    .single();

  if (batchErr || !batch) {
    console.error('Failed to create import_batches record:', batchErr);
    throw batchErr;
  }
  console.log(`Created import_batches ID: ${batch.id}`);

  // 4. Prepare payload
  const rows = qs.map(q => ({
    subject_id: q.subject_id,
    chapter_id: q.chapter_id,
    topic_id: q.topic_id,
    batch_id: batch.id,
    type: 'open',
    content: q.content_ru,
    content_ru: q.content_ru,
    content_tg: q.content_tg,
    correct_numeric_answer: q.correct_numeric_answer,
    image_url: q.image_url,
    version: 1,
    is_deleted: false,
    created_by: auth.user.id,
  }));

  // 5. Insert in chunks
  const CHUNK_SIZE = 25;
  let totalInserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { data: inserted, error: insErr } = await supabase
      .from('questions')
      .insert(chunk)
      .select('id');

    if (insErr) {
      console.error(`Error inserting chunk starting at index ${i}:`, insErr);
      throw insErr;
    }
    totalInserted += inserted.length;
    console.log(`Inserted chunk ${Math.floor(i / CHUNK_SIZE) + 1} (${totalInserted} / ${rows.length})`);
  }

  // 6. Update batch count
  await supabase
    .from('import_batches')
    .update({ items_count: totalInserted })
    .eq('id', batch.id);

  console.log(`\nSUCCESS: Successfully imported all ${totalInserted} questions! Batch ID: ${batch.id}`);
}

main().catch(console.error);
