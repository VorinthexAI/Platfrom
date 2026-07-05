import { Spinner } from "@vorinthex/shared/ui";

export default function ConsoleLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner />
    </div>
  );
}
