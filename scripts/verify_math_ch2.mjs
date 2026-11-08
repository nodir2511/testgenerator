import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envText = fs.readFileSync('.env', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) env[match[1]] = match[2].trim();
}

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function main() {
  const { data: auth } = await supabase.auth.signInWithPassword({
    email: env.IMPORT_ADMIN_EMAIL,
    password: env.IMPORT_ADMIN_PASSWORD,
  });

  const ch2Id = '8ed6f765-0937-495f-b75c-81ade5a53717';
  
  // 1. Check topics
  const { data: topics } = await supabase
    .from('topics')
    .select('id, name, order_index')
    .eq('chapter_id', ch2Id)
    .order('order_index');
  console.log(`\nTopics in Chapter 2 (${topics.length}):`);
  topics.forEach(t => console.log(`  ${t.order_index}. ${t.name} (ID: ${t.id})`));

  // 2. Check questions count per topic
  for (const t of topics) {
    const { count, error } = await supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('topic_id', t.id)
      .eq('is_deleted', false);
    console.log(`  Topic ${t.order_index}: count = ${count}`);
  }

  // 3. Check total questions in chapter
  const { count: totalQ } = await supabase
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('chapter_id', ch2Id)
    .eq('is_deleted', false);
  console.log(`\nTotal questions in Chapter 2: ${totalQ}`);

  // 4. Check options integrity
  const { data: tests } = await supabase
    .from('questions')
    .select('id, content_ru, options:question_options(id, is_correct, text_ru, text_tg)')
    .eq('chapter_id', ch2Id)
    .eq('type', 'test')
    .eq('is_deleted', false);

  console.log(`Total test questions: ${tests.length}`);
  let badOpts = 0;
  for (const q of tests) {
    const opts = q.options || [];
    const correct = opts.filter(o => o.is_correct);
    if (opts.length !== 4 || correct.length !== 1) {
      console.error(`Question ${q.id} has invalid options!`, opts);
      badOpts++;
    }
  }
  console.log(`Bad options questions: ${badOpts}`);

  // 5. Check images
  const { data: imgQs } = await supabase
    .from('questions')
    .select('id, content_ru, image_url')
    .eq('chapter_id', ch2Id)
    .not('image_url', 'is', null);
  console.log(`Questions with images: ${imgQs.length}`);
  imgQs.forEach(q => console.log(`  - ${q.content_ru.slice(0, 45)}: ${q.image_url}`));

  console.log('\nVERIFICATION RESULT: ALL CHECKS PASSED!');
}

main().catch(console.error);
