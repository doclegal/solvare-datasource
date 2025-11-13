import RecordPreparation from '../RecordPreparation';

const mockPreparedRecords = [
  {
    ecli: "ECLI:NL:HR:2024:123",
    title: "Hoger beroep tegen vonnis inzake arbeidsovereenkomst",
    court: "Hoge Raad",
    decisionDate: "2024-01-15",
    legalArea: ["Civiel recht", "Arbeidsrecht"],
    procedureType: "Hoger beroep",
    sourceUrl: "https://uitspraken.rechtspraak.nl/details?id=ECLI:NL:HR:2024:123",
    fullText: "De Hoge Raad der Nederlanden, Civiele Kamer, heeft op 15 januari 2024 recht gedaan in de zaak van... [volledige tekst van de uitspraak volgt hier met alle overwegingen en beslissingen van het hof in deze arbeidsrechtelijke zaak]"
  },
  {
    ecli: "ECLI:NL:RBDHA:2024:456",
    title: "Beslissing op bezwaar WOB-verzoek",
    court: "Rechtbank Den Haag",
    decisionDate: "2024-01-12",
    legalArea: ["Bestuursrecht"],
    procedureType: "Eerste aanleg",
    sourceUrl: "https://uitspraken.rechtspraak.nl/details?id=ECLI:NL:RBDHA:2024:456",
    fullText: "Rechtbank Den Haag, zittingsplaats Den Haag, Bestuursrecht, heeft op 12 januari 2024 uitspraak gedaan... [complete tekst van de bestuursrechtelijke uitspraak]"
  }
];

export default function RecordPreparationExample() {
  return (
    <RecordPreparation
      ecliCount={25}
      preparedRecords={mockPreparedRecords}
      onFetchContent={() => console.log('Fetch content triggered')}
      onClear={() => console.log('Clear records triggered')}
      isLoading={false}
    />
  );
}
