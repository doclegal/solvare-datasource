#!/usr/bin/env node

const batchId = '4bc1d2e3-87cf-4ca0-a34c-e21a4c9bc69d';

async function checkStatus() {
  const response = await fetch(`http://localhost:5000/api/rechtspraak/batch/${batchId}`);
  const data = await response.json();
  
  const records = data.batch.records;
  const enriched = records.filter(r => r.ai_inhoudsindicatie);
  
  console.log(`✅ Totaal records: ${records.length}`);
  console.log(`✨ AI-verrijkt: ${enriched.length}`);
  console.log(`⏳ Nog te doen: ${records.length - enriched.length}`);
  console.log(`📊 Voortgang: ${Math.round((enriched.length / records.length) * 100)}%`);
}

checkStatus();
