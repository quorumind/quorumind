import type { SVGProps } from "react";

// A small set of outline icons on a 24px grid, 1.5px stroke, drawn for Quorumind.
function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export const CheckIcon = () => (
  <Icon>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const WarningIcon = () => (
  <Icon>
    <path d="M12 3.5l9.5 16.5h-19z" />
    <path d="M12 10v4.5" />
    <path d="M12 17.5v.01" />
  </Icon>
);

export const CrossIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </Icon>
);

export const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </Icon>
);

export const MoonIcon = () => (
  <Icon>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
  </Icon>
);

export const MonitorIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Icon>
);

export const DownloadIcon = () => (
  <Icon>
    <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />
  </Icon>
);

export const RetryIcon = () => (
  <Icon>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v3.5H8" />
  </Icon>
);

export const ArrowIcon = () => (
  <Icon className="flip-rtl">
    <path d="M5 12h14M13.5 6.5L19 12l-5.5 5.5" />
  </Icon>
);

export const MenuIcon = () => (
  <Icon>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const PlayIcon = () => (
  <Icon>
    <path d="M8 5.5v13l10.5-6.5z" />
  </Icon>
);

// Modes and roles.

/** Two options facing each other: the standard debate. */
export const CompareIcon = () => (
  <Icon>
    <path d="M4 7h9" />
    <path d="M10 4l3 3-3 3" />
    <path d="M20 17h-9" />
    <path d="M14 14l-3 3 3 3" />
  </Icon>
);

/** Express: one short round. */
export const BoltIcon = () => (
  <Icon>
    <path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" />
  </Icon>
);

/** Challenge my idea: the models aim at the person's own solution. */
export const TargetIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="0.8" fill="currentColor" />
  </Icon>
);

/** An audit: a document under a magnifying glass. */
export const AuditIcon = () => (
  <Icon>
    <path d="M13.5 3.5H6v17h5.5" />
    <path d="M13.5 3.5L17.5 7.5V10M13.5 3.5v4h4" />
    <path d="M9 10h3M9 13.5h2" />
    <circle cx="16" cy="15.5" r="3.5" />
    <path d="M18.5 18l2.5 2.5" />
  </Icon>
);

/** The devil's advocate: a contrary arrow cutting across the line of agreement. */
export const DevilIcon = () => (
  <Icon>
    <path d="M3.5 12h17" strokeDasharray="2 2.5" />
    <path d="M7 19L17 5" />
    <path d="M12.5 5H17v4.5" />
  </Icon>
);

/** The interviewer: a question in a speech bubble. */
export const InterviewIcon = () => (
  <Icon>
    <path d="M4.5 5.5h15v10h-8l-4 3.5v-3.5h-3z" />
    <path d="M10 9a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.2" />
    <circle cx="12" cy="13.6" r="0.4" fill="currentColor" />
  </Icon>
);

/** The arbiter: the scales that weigh the options. */
export const ArbiterIcon = () => (
  <Icon>
    <path d="M12 4v16M8 20h8M5 7h14" />
    <path d="M5 7l-2.5 6a2.5 2.5 0 0 0 5 0z" />
    <path d="M19 7l-2.5 6a2.5 2.5 0 0 0 5 0z" />
  </Icon>
);

/** The arbiter's probe: a beam on an angle nobody looked at. */
export const ProbeIcon = () => (
  <Icon>
    <path d="M4 20l6-6" />
    <circle cx="14" cy="10" r="5" />
    <path d="M14 7.5v2.5l1.8 1.2" />
  </Icon>
);

export const ShareIcon = () => (
  <Icon>
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M8.3 10.8l7.4-3.6M8.3 13.2l7.4 3.6" />
  </Icon>
);

/** Start again from this session: a branch. */
export const BranchIcon = () => (
  <Icon>
    <circle cx="6" cy="5.5" r="2" />
    <circle cx="6" cy="18.5" r="2" />
    <circle cx="18" cy="8.5" r="2" />
    <path d="M6 7.5v9" />
    <path d="M18 10.5c0 4-6 3-11 6.5" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M4.5 7h15" />
    <path d="M9.5 7V4.5h5V7" />
    <path d="M6.5 7l1 12.5h9l1-12.5" />
    <path d="M10.5 11v5M13.5 11v5" />
  </Icon>
);

export const StopIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
  </Icon>
);

export const GalleryIcon = () => (
  <Icon>
    <rect x="3.5" y="4.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="4.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="14" width="7" height="5.5" rx="1.5" />
    <rect x="13.5" y="14" width="7" height="5.5" rx="1.5" />
  </Icon>
);

/** The decision register: a list whose lines are ticked. */
export const RegisterIcon = () => (
  <Icon>
    <path d="M4 6.5l1.5 1.5L8 5.5M4 12.5l1.5 1.5L8 11.5M4 18.5l1.5 1.5L8 17.5M11 7h9M11 13h9M11 19h9" />
  </Icon>
);

export const SettingsIcon = () => (
  <Icon>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Icon>
);

/** Runs on this machine: nothing leaves it. */
export const LocalIcon = () => (
  <Icon>
    <path d="M4 10.5L12 4l8 6.5V20H4z" />
    <path d="M9.5 20v-5.5h5V20" />
  </Icon>
);

export const SparkIcon = () => (
  <Icon>
    <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4" />
    <path d="M12 9l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" />
  </Icon>
);

export const MapIcon = () => (
  <Icon>
    <path d="M4 6.5h16M4 12h16M4 17.5h16" strokeDasharray="0.5 3" />
    <circle cx="8" cy="6.5" r="1.8" fill="currentColor" />
    <circle cx="15" cy="12" r="1.8" fill="currentColor" />
    <circle cx="11" cy="17.5" r="1.8" fill="currentColor" />
  </Icon>
);

export const LockIcon = () => (
  <Icon>
    <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Icon>
);

export const ExternalIcon = () => (
  <Icon width="14" height="14">
    <path d="M13.5 5.5h5v5" />
    <path d="M18.5 5.5l-8 8" />
    <path d="M16.5 13.5v4a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V9.5A1.5 1.5 0 0 1 7 8h4" />
  </Icon>
);

/** A file going up: an upload. */
export const UploadIcon = () => (
  <Icon>
    <path d="M12 15.5V4.5M7.5 9L12 4.5 16.5 9" />
    <path d="M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="M15 15l5 5" />
  </Icon>
);
