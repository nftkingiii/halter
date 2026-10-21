// Small inline icons, 1.75 stroke, no diagonal arrows.
const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const IconMandate = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...S} d="M6 4v16M18 4v16" />
    <path {...S} d="M6 10.5c3 3.2 9 3.2 12 0" />
    <circle {...S} cx="12" cy="15.5" r="2" />
  </svg>
);
export const IconActivity = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path {...S} d="M9 6h11M9 12h11M9 18h11" />
    <circle {...S} cx="4.5" cy="6" r="1" /><circle {...S} cx="4.5" cy="12" r="1" /><circle {...S} cx="4.5" cy="18" r="1" />
  </svg>
);
export const IconCard = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect {...S} x="3" y="5" width="18" height="14" rx="3" />
    <path {...S} d="M7 10h6M7 14h10" />
  </svg>
);
export const IconCheck = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path {...S} d="M3.5 8.5l3 3 6-7" /></svg>
);
export const IconStop = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><circle {...S} cx="8" cy="8" r="5.5" /><path {...S} d="M4.2 11.8l7.6-7.6" /></svg>
);
export const IconPulse = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path {...S} d="M1.5 8h3l1.5-4 3 8 1.5-4h4" /></svg>
);
export const IconKey = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><circle {...S} cx="5" cy="8" r="2.5" /><path {...S} d="M7.5 8h7M12 8v2.5" /></svg>
);
