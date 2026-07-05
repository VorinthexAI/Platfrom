import { Button, Card } from "@vorinthex/shared/ui";

// Placeholder empty-state dashboard — swap for the real console experience
// when it's time to design this screen. Follows the design system's Empty
// States guidance: explain, guide, provide a CTA.
export default function ConsoleHomePage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md text-center">
        <p className="cui-label">Console</p>
        <h1 className="mt-2 text-3xl font-normal">Nothing running yet.</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          This is where your work will show up once there&apos;s something to show.
        </p>
        <Button className="mt-6" variant="primary">
          Get started
        </Button>
      </Card>
    </div>
  );
}
