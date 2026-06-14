import type { TravelMode } from "@meetup/core";

const MODES: Array<{ value: TravelMode; label: string }> = [
  { value: "transit", label: "Public transport" },
  { value: "walking", label: "Walking" },
  { value: "driving", label: "Driving" },
];

interface ModePickerProps {
  value: TravelMode;
  onChange: (value: TravelMode) => void;
}

export function ModePicker({ value, onChange }: ModePickerProps) {
  return (
    <div className="segmented" role="group" aria-label="Travel mode">
      {MODES.map((mode) => (
        <button
          type="button"
          key={mode.value}
          className={"segmented__item" + (value === mode.value ? " is-active" : "")}
          aria-pressed={value === mode.value}
          onClick={() => onChange(mode.value)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
