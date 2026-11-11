import React, { useEffect, useState } from "react";

export function WorkoutConfetti() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div className="workout-confetti" aria-hidden="true">
      {Array.from({ length: 140 }, (_, index) => (
        <i
          key={index}
          style={{
            left: `${(index * 37) % 100}%`,
            backgroundColor: [
              "#f97316",
              "#facc15",
              "#22c55e",
              "#38bdf8",
              "#c084fc",
              "#fb7185",
            ][index % 6],
            animationDelay: `${index * 20}ms`,
            animationDuration: `${2400 + (index % 9) * 100}ms`,
            "--drift": `${((index * 23) % 160) - 80}px`,
            "--spin": `${360 + (index % 5) * 180}deg`,
          }}
        />
      ))}
    </div>
  );
}
