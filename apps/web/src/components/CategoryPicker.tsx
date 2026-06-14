import type { VenueCategory } from "@meetup/core";

const CATEGORIES: Array<{ value: VenueCategory; label: string; hint: string }> = [
  { value: "cafe", label: "Cafe", hint: "Coffee and a catch up" },
  { value: "lunch", label: "Lunch", hint: "Daytime restaurants" },
  { value: "dinner", label: "Dinner", hint: "Evening restaurants" },
  { value: "pub", label: "Pub", hint: "Pubs and bars" },
  { value: "park", label: "Park", hint: "Parks and outdoor spaces" },
];

interface CategoryPickerProps {
  value: VenueCategory;
  onChange: (value: VenueCategory) => void;
}

export function CategoryPicker({ value, onChange }: CategoryPickerProps) {
  return (
    <div className="segmented" role="group" aria-label="Venue category">
      {CATEGORIES.map((category) => (
        <button
          type="button"
          key={category.value}
          className={"segmented__item" + (value === category.value ? " is-active" : "")}
          aria-pressed={value === category.value}
          title={category.hint}
          onClick={() => onChange(category.value)}
        >
          {category.label}
        </button>
      ))}
    </div>
  );
}
