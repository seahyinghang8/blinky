import { useEffect, useState } from 'react';
import './App.css';
import { MessageHistory } from './components/MessageHistory';
import { UserInputAndControl } from './components/UserInputAndControl';
import './userWorker';
import { backend } from './utils/backend';

function App() {
  const [isRunning, setIsRunning] = useState(false);
  useEffect(() => {
    backend.request<boolean>('isRunning').then((isRunning) => {
      setIsRunning(isRunning);
    });
    backend.registerUpdateHandler<boolean>('isRunning', (isRunning) => {
      setIsRunning(isRunning);
    });
  }, []);
  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100%',
      }}
    >
      <MessageHistory isRunning={isRunning} />
      <div
        style={{
          width: '100%',
          padding: '0 20px',
          boxSizing: 'border-box',
        }}
      >
        <UserInputAndControl isRunning={isRunning} />
      </div>
    </main>
  );
}

export default App;
