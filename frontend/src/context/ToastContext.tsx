import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';
interface Toast { id: number; type: ToastType; message: string }

const Ctx = createContext<{ toast: (type: ToastType, message: string) => void }>(null as any);
export const useToast = () => useContext(Ctx);

const styles: Record<ToastType, { border: string; icon: ReactNode }> = {
  success: { border: 'border-emerald-300', icon: <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" /> },
  error: { border: 'border-red-300', icon: <XCircle className="w-5 h-5 text-red-500 shrink-0" /> },
  warning: { border: 'border-amber-300', icon: <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" /> },
  info: { border: 'border-sky-300', icon: <Info className="w-5 h-5 text-sky-500 shrink-0" /> },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((type: ToastType, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${styles[t.type].border}`}>
            {styles[t.type].icon}
            <p className="text-sm text-slate-700 flex-1">{t.message}</p>
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
