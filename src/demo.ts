import { useFetch, EqueryClient } from './index';

// Mock generic async function
async function mockFetcher({ signal }: { signal: AbortSignal }) {
    return new Promise<{ message: string }>((resolve, reject) => {
        const timeout = setTimeout(() => {
            resolve({ message: "Hello from function!" });
        }, 1000);

        signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error("Aborted"));
        });
    });
}

function runDemo1() {
    console.log("--- Demo 1: Function Endpoint ---");
    useFetch(mockFetcher)
        .onComplete((result) => {
            console.log("[Demo 1] Result:", result);
        })
        .then((res) => {
            console.log("[Demo 1] Promise Resolved:", res);
        });
}

function runDemo2() {
    console.log("\n--- Demo 2: String Endpoint ---");
    const chain = useFetch('https://jsonplaceholder.typicode.com/todos/1');

    chain.onComplete((result) => {
        console.log("[Demo 2] Result Data:", result.data);
        console.log("[Demo 2] Result Error:", result.error);
    });
}

function runDemo3() {
    console.log("\n--- Demo 3: Cancellation ---");
    const cancelChain = useFetch(mockFetcher);

    cancelChain.onComplete((result) => {
        console.log("[Demo 3] Canceled Result (should show isCanceled: true):", result.isCanceled);
    });

    setTimeout(() => {
        console.log("[Demo 3] Canceling...");
        cancelChain.cancel();
    }, 200);
}

function runDemo4() {
    console.log("\n--- Demo 4: Client with default Headers ---");
    // Mocking auth behavior
    const client = new EqueryClient({
        headers: {
            'Authorization': 'Bearer demo-token-123',
            'X-Custom-Header': 'persistent-value'
        }
    });

    // In a real browser env, we can't easily inspect headers sent without intercepting.
    // So here we'll just demonstrate the call logic and printing.
    // In a real app, you'd see the headers in the network tab.

    console.log("Created client with Auth token.");
    console.log("Fetching using client.useFetch()...");

    client.useFetch('https://jsonplaceholder.typicode.com/todos/1')
        .onComplete((result) => {
            console.log("[Demo 4] Result Data:", result.data);
            console.log("[Demo 4] (Implicitly sent Authorization and X-Custom-Header)");
        });
}

// Main logic
const demoId = process.argv[2];

if (!demoId) {
    console.log("Running all demos... (pass '1', '2', '3', or '4' to run specific demo)");
    runDemo1();
    runDemo2();
    runDemo3();
    runDemo4();
} else {
    switch (demoId) {
        case '1':
            runDemo1();
            break;
        case '2':
            runDemo2();
            break;
        case '3':
            runDemo3();
            break;
        case '4':
            runDemo4();
            break;
        default:
            console.error(`Unknown demo ID: ${demoId}`);
            console.log("Available demos: 1, 2, 3, 4");
            process.exit(1);
    }
}
