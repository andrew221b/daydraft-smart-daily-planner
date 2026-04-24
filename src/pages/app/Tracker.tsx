import { Shell } from "@/components/app/Shell";
import { TrackerView } from "@/components/app/TrackerPill";

export default function Tracker() {
  return (
    <Shell>
      <div className="px-1 pt-2 pb-24">
        <TrackerView />
      </div>
    </Shell>
  );
}