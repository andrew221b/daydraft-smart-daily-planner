import { Shell } from "@/components/app/Shell";
import { TrackerView } from "@/components/app/TrackerPill";

export default function Tracker() {
  return (
    <Shell>
      <div className="px-1 pt-6 pb-28">
        <TrackerView />
      </div>
    </Shell>
  );
}