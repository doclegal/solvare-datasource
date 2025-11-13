import FilterSection from '../FilterSection';

export default function FilterSectionExample() {
  return (
    <FilterSection 
      onFetch={(filters) => console.log('Fetch triggered with filters:', filters)}
      onReset={() => console.log('Reset triggered')}
      isLoading={false}
    />
  );
}
