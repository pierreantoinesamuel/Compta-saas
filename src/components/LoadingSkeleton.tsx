import React from 'react';

interface Props {
  rows?: number;
  cols?: number;
}

export function LoadingSkeleton({ rows = 5, cols = 4 }: Props) {
  return (
    <div className="pl-table-card" role="status" aria-label="Chargement en cours…">
      <table className="pl-table" aria-busy="true">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>
                  <div
                    className="pl-skeleton-line"
                    style={{ width: c === 0 ? '60%' : c === cols - 1 ? '40%' : '80%' }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
