import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';

async function checkXmlStructure() {
  const bwbId = 'BWBV0001716';
  
  console.log(`=== Analyseren XML-structuur van ${bwbId} ===\n`);
  
  // Try different URLs
  const urls = [
    `https://wetten.overheid.nl/${bwbId}/2021-09-02/xml`,
    `https://repository.overheid.nl/frbr/bwb/${bwbId}/2021-09-02/xml`,
    `https://zoek.officielebekendmakingen.nl/bwb-xml/${bwbId}`,
  ];
  
  let xmlContent: string | null = null;
  
  for (const url of urls) {
    try {
      console.log(`Probeer: ${url}`);
      const response = await axios.get(url, { 
        timeout: 30000,
        headers: { 'Accept': 'application/xml' }
      });
      if (response.data) {
        xmlContent = response.data;
        console.log(`✓ Succes!\n`);
        break;
      }
    } catch (e: any) {
      console.log(`✗ ${e.message}`);
    }
  }
  
  if (!xmlContent) {
    // Try via SRU
    console.log('\nProbeer via SRU API...');
    const sruUrl = `https://zoek.officielebekendmakingen.nl/sru/Search?version=1.2&operation=searchRetrieve&x-connection=BWB&query=work.identifier=${bwbId}&startRecord=1&maximumRecords=1`;
    
    try {
      const response = await axios.get(sruUrl, { timeout: 30000 });
      console.log('SRU response length:', response.data.length);
      
      // Parse to find the record URL
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
      const sruParsed = parser.parse(response.data);
      
      // Look for gzd:gzd element which contains the actual content
      const searchRetrieve = sruParsed['srw:searchRetrieveResponse'] || sruParsed['searchRetrieveResponse'] || {};
      const records = searchRetrieve['srw:records'] || searchRetrieve['records'] || {};
      const record = records['srw:record'] || records['record'];
      
      if (record) {
        const recordData = record['srw:recordData'] || record['recordData'];
        const gzd = recordData?.['gzd:gzd'] || recordData?.['gzd'];
        
        if (gzd) {
          console.log('Gevonden gzd:gzd element');
          console.log('Keys:', Object.keys(gzd).filter(k => !k.startsWith('@_')).join(', '));
          
          // The originalData contains the law XML
          const originalData = gzd['gzd:originalData'] || gzd['originalData'];
          if (originalData) {
            const wetgeving = originalData['wetgeving'] || originalData['wet'];
            if (wetgeving) {
              console.log('\n=== WETGEVING STRUCTUUR ===');
              console.log('Top-level keys:', Object.keys(wetgeving).filter(k => !k.startsWith('@_')).join(', '));
              
              const wetBesluit = wetgeving['wet-besluit'];
              if (wetBesluit) {
                console.log('\nwet-besluit keys:', Object.keys(wetBesluit).filter(k => !k.startsWith('@_')).join(', '));
                
                // Look for bijlage
                if (wetBesluit['bijlage']) {
                  const bijlagen = Array.isArray(wetBesluit['bijlage']) ? wetBesluit['bijlage'] : [wetBesluit['bijlage']];
                  console.log(`\nGevonden ${bijlagen.length} bijlage(n)`);
                  
                  for (let i = 0; i < bijlagen.length; i++) {
                    const b = bijlagen[i];
                    console.log(`\nBijlage ${i + 1}:`);
                    console.log('  Keys:', Object.keys(b).filter(k => !k.startsWith('@_')).slice(0, 10).join(', '));
                    
                    // Check for kop
                    if (b['kop']) {
                      const kop = b['kop'];
                      console.log('  kop.label:', kop['label'] || kop['titel']);
                    }
                  }
                }
                
                // Look for wettekst
                if (wetBesluit['wettekst']) {
                  console.log('\nGevonden wettekst');
                  const wettekst = wetBesluit['wettekst'];
                  console.log('  wettekst keys:', Object.keys(wettekst).filter(k => !k.startsWith('@_')).slice(0, 10).join(', '));
                }
              }
            }
          }
        }
      }
    } catch (e: any) {
      console.error('SRU Error:', e.message);
    }
  }
}

checkXmlStructure().catch(console.error);
