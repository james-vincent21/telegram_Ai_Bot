import React from 'react';

export default function Aurora() {
  return (
    <div className="aurora" aria-hidden="true">
      <div className="aurora-blob -top-40 -left-32 w-[520px] h-[520px] bg-violet-600/25 animate-float" />
      <div className="aurora-blob top-1/3 -right-40 w-[560px] h-[560px] bg-fuchsia-600/15 animate-float-slow" />
      <div className="aurora-blob -bottom-48 left-1/3 w-[520px] h-[520px] bg-cyan-500/15 animate-float" />
    </div>
  );
}
