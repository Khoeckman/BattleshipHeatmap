export default async function awaitWorker<T>(worker: Worker): Promise<T> {
  const result = await new Promise((resolve: (value: T) => void, reject) => {
    const handleMessage = (e: MessageEvent) => {
      worker.removeEventListener('message', handleMessage)
      resolve(e.data)
    }

    const handleError = (err: ErrorEvent) => {
      worker.removeEventListener('error', handleError)
      reject(err)
    }

    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', handleError)
  })
  worker.terminate()

  return result
}
