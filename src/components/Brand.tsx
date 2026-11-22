export function Brand() {
  return <span className="brand"><img src="/design/brand.svg" alt="" /><span>Under<span className="brand-accent">Ctrl</span><small>Координация IT</small></span></span>;
}

const keycaps = ['mts', 'drop', 'pulse', 'plus', 'small-drop', 'brackets', 'mts-large', 'pulse-small'];

export function KeycapPattern() {
  return <div className="keycap-pattern" aria-hidden="true">{keycaps.map(key => <img key={key} src={`/design/key-${key}.svg`} alt="" />)}</div>;
}
