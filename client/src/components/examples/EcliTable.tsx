import EcliTable from '../EcliTable';

const mockRecords = [
  {
    ecli: "ECLI:NL:HR:2024:123",
    title: "Hoger beroep tegen vonnis inzake arbeidsovereenkomst",
    court: "Hoge Raad",
    decisionDate: "2024-01-15"
  },
  {
    ecli: "ECLI:NL:RBDHA:2024:456",
    title: "Beslissing op bezwaar WOB-verzoek",
    court: "Rechtbank Den Haag",
    decisionDate: "2024-01-12"
  },
  {
    ecli: "ECLI:NL:GHARL:2024:789",
    title: "Hoger beroep strafzaak witwassen",
    court: "Gerechtshof Arnhem-Leeuwarden",
    decisionDate: "2024-01-10"
  },
];

export default function EcliTableExample() {
  return (
    <EcliTable 
      records={mockRecords}
      currentPage={1}
      totalResults={156}
      onLoadMore={() => console.log('Load more triggered')}
      onPrevious={() => console.log('Previous triggered')}
      onNext={() => console.log('Next triggered')}
      onClear={() => console.log('Clear triggered')}
      isLoading={false}
    />
  );
}
