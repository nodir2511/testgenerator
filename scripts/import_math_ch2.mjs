import fs from 'fs';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const envText = fs.readFileSync('.env', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) env[match[1]] = match[2].trim();
}

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const topicsData = JSON.parse(fs.readFileSync('scratch/math_ch2_prepared.json', 'utf8'));

const totalQuestions = topicsData.reduce((acc, t) => acc + t.questions.length, 0);

async function main() {
  console.log(`Connecting to Supabase at ${env.VITE_SUPABASE_URL}...`);
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: env.IMPORT_ADMIN_EMAIL,
    password: env.IMPORT_ADMIN_PASSWORD,
  });
  if (authErr) throw authErr;
  console.log(`Authenticated as ${auth.user.email} (ID: ${auth.user.id})`);

  // 1. Get Subject 'Математика'
  const { data: subjects, error: subjErr } = await supabase
    .from('subjects')
    .select('id, name')
    .eq('name', 'Математика')
    .eq('is_deleted', false);
  if (subjErr) throw subjErr;
  if (!subjects || subjects.length === 0) throw new Error('Subject Математика not found');
  const subjectId = subjects[0].id;
  console.log(`Subject Математика ID: ${subjectId}`);

  // 2. Check / Create Source
  const sourceName = 'Сборник математики (Часть 2)';
  let sourceId = null;
  const { data: sources, error: srcErr } = await supabase
    .from('sources')
    .select('id, name')
    .eq('name', sourceName)
    .eq('is_deleted', false);
  if (srcErr) throw srcErr;
  if (sources && sources.length > 0) {
    sourceId = sources[0].id;
    console.log(`Found existing Source "${sourceName}": ${sourceId}`);
  } else {
    const newSrcId = randomUUID();
    const { error: insSrcErr } = await supabase
      .from('sources')
      .insert({ id: newSrcId, name: sourceName });
    if (insSrcErr) throw insSrcErr;
    sourceId = newSrcId;
    console.log(`Created new Source "${sourceName}": ${sourceId}`);
  }

  // 3. Check / Create Chapter 2
  let chapterId = null;
  const { data: chapters, error: chErr } = await supabase
    .from('chapters')
    .select('id, name, order_index')
    .eq('subject_id', subjectId)
    .eq('name', 'Глава 2')
    .eq('is_deleted', false);
  if (chErr) throw chErr;
  if (chapters && chapters.length > 0) {
    chapterId = chapters[0].id;
    console.log(`Found existing Chapter 2: ${chapterId}`);
  } else {
    const newChId = randomUUID();
    const { error: insChErr } = await supabase
      .from('chapters')
      .insert({
        id: newChId,
        subject_id: subjectId,
        name: 'Глава 2',
        order_index: 2,
      });
    if (insChErr) throw insChErr;
    chapterId = newChId;
    console.log(`Created new Chapter 2: ${chapterId}`);
  }

  // 4. Create import batch
  const batchFilename = `Математика, глава 2 (рус+тадж, ${totalQuestions} вопр.)`;
  const { data: dupBatches, error: dupBErr } = await supabase
    .from('import_batches')
    .select('id')
    .eq('filename', batchFilename);
  if (dupBErr) throw dupBErr;
  if (dupBatches && dupBatches.length > 0) {
    console.log(`Warning: Batch "${batchFilename}" already exists (ID: ${dupBatches[0].id}).`);
  }

  const batchId = randomUUID();
  const { error: batchErr } = await supabase
    .from('import_batches')
    .insert({
      id: batchId,
      created_by: auth.user.id,
      filename: batchFilename,
      items_count: totalQuestions,
    });
  if (batchErr) throw batchErr;
  console.log(`Created import_batches ID: ${batchId}`);

  // 5. Insert topics, questions, and options
  let totalQuestionsInserted = 0;
  let totalOptionsInserted = 0;

  for (const t of topicsData) {
    console.log(`\n--- Processing Topic ${t.n}: ${t.name} ---`);
    // Check if topic exists
    let topicId = null;
    const { data: exTopics, error: exTopErr } = await supabase
      .from('topics')
      .select('id')
      .eq('chapter_id', chapterId)
      .eq('order_index', t.n)
      .eq('is_deleted', false);
    if (exTopErr) throw exTopErr;

    if (exTopics && exTopics.length > 0) {
      topicId = exTopics[0].id;
      console.log(`Using existing topic ID: ${topicId}`);
    } else {
      const newTopicId = randomUUID();
      const { error: insTopErr } = await supabase
        .from('topics')
        .insert({
          id: newTopicId,
          chapter_id: chapterId,
          name: t.name,
          order_index: t.n,
        });
      if (insTopErr) throw insTopErr;
      topicId = newTopicId;
      console.log(`Created topic ID: ${topicId}`);
    }

    const qRows = [];
    const optRows = [];

    for (const q of t.questions) {
      const qId = randomUUID();
      qRows.push({
        id: qId,
        subject_id: subjectId,
        chapter_id: chapterId,
        topic_id: topicId,
        source_id: sourceId,
        batch_id: batchId,
        type: q.type,
        content: q.content_ru,
        content_ru: q.content_ru,
        content_tg: q.content_tg,
        image_url: q.image_url,
        correct_numeric_answer: q.correct_numeric_answer,
        version: 1,
        is_deleted: false,
        created_by: auth.user.id,
      });

      if (q.options) {
        for (const o of q.options) {
          optRows.push({
            id: randomUUID(),
            question_id: qId,
            text: o.text_ru,
            text_ru: o.text_ru,
            text_tg: o.text_tg,
            is_correct: o.is_correct,
            order_index: o.order_index,
          });
        }
      }
    }

    // Insert questions in chunks
    const CHUNK_Q = 50;
    for (let i = 0; i < qRows.length; i += CHUNK_Q) {
      const chunk = qRows.slice(i, i + CHUNK_Q);
      const { error: qInsErr } = await supabase.from('questions').insert(chunk);
      if (qInsErr) {
        console.error(`Error inserting questions for topic ${t.n}:`, qInsErr);
        throw qInsErr;
      }
    }
    totalQuestionsInserted += qRows.length;

    // Insert options in chunks
    const CHUNK_OPT = 100;
    for (let i = 0; i < optRows.length; i += CHUNK_OPT) {
      const chunk = optRows.slice(i, i + CHUNK_OPT);
      const { error: optInsErr } = await supabase.from('question_options').insert(chunk);
      if (optInsErr) {
        console.error(`Error inserting options for topic ${t.n}:`, optInsErr);
        throw optInsErr;
      }
    }
    totalOptionsInserted += optRows.length;

    console.log(`Topic ${t.n} complete: ${qRows.length} questions, ${optRows.length} options.`);
  }

  // Update batch items_count
  await supabase
    .from('import_batches')
    .update({ items_count: totalQuestionsInserted })
    .eq('id', batchId);

  console.log(`\n========================================`);
  console.log(`IMPORT COMPLETED SUCCESSFULLY!`);
  console.log(`Batch ID: ${batchId}`);
  console.log(`Total questions inserted: ${totalQuestionsInserted}`);
  console.log(`Total options inserted: ${totalOptionsInserted}`);
  console.log(`========================================`);
}

main().catch(err => {
  console.error('Fatal error during import:', err);
  process.exit(1);
});
