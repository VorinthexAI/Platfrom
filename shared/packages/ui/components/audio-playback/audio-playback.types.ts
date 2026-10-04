export type AudioPlaybackProps = {
  title: string;
  position: number;
  duration: number;
  playing: boolean;
  error?: string | null;
  onToggle: () => void;
  onSeek: (seconds: number) => void | Promise<void>;
  onClose: () => void;
};
