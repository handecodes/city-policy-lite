/** The Paris enamel street plaque. Labels every street the policy pushes traffic onto. */
export function Plaque({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={"plaque " + className}>
      <small>4e Arrt</small>
      <strong>{name.replace(/'/g, "’")}</strong>
    </span>
  );
}

export function plaqueEl(name: string) {
  const s = document.createElement("span");
  s.className = "plaque";
  const sm = document.createElement("small");
  sm.textContent = "4e Arrt";
  const st = document.createElement("strong");
  st.textContent = name.replace(/'/g, "’");
  s.append(sm, st);
  return s;
}
