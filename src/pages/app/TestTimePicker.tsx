import React, { useRef } from "react";
export default function TestTimePicker() {
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerPicker = () => {
    if (inputRef.current) {
      inputRef.current.type = "time";
      try {
        (inputRef.current).showPicker();
      } catch (e) {
        inputRef.current.click();
      }
    }
  };
  return (
    <div className="p-10">
      <button onClick={triggerPicker} className="bg-blue-500 text-white p-4 rounded">
        Open Global Picker
      </button>
      <input
        ref={inputRef}
        type="text"
        className="absolute w-[1px] h-[1px] opacity-0 pointer-events-none"
        onChange={(e) => console.log("Time picked:", e.target.value)}
        onBlur={() => { if (inputRef.current) inputRef.current.type = "text"; }}
      />
    </div>
  );
}
