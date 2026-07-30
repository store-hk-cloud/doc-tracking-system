import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabaseUrl = 'https://xebrtqvxmbjidrkvdktn.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhlYnJ0cXZ4bWJqaWRya3Zka3RuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mjk3NzUwNCwiZXhwIjoyMDk4NTUzNTA0fQ.KMYDTC4RGrX_KseRr9rQHBN_pGROroEf5oJg_7ynojc';

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const sql = readFileSync('supabase/migrations/001_initial_schema.sql', 'utf8');

async function main() {
  try {
    // Execute SQL via REST API
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'params=single-object',
      },
      body: JSON.stringify({ query: sql }),
    });

    // Try direct SQL execution via management API
    const mgmtRes = await fetch('https://api.supabase.com/v1/projects/xebrtqvxmbjidrkvdktn/sql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    });

    if (mgmtRes.ok) {
      console.log('✅ Schema created successfully!');
    } else {
      const err = await mgmtRes.text();
      console.log('⚠️ Management API:', mgmtRes.status, err.substring(0, 200));
      // Fallback: try raw SQL via POST to pg
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
}

main();