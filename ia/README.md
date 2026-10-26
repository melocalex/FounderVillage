# Working with an AI agent

This folder helps a developer and an AI agent build on Founder Village without guessing.

| File | Use |
|---|---|
| [DEVELOPER_CONTEXT.md](DEVELOPER_CONTEXT.md) | The facts: actors, accounts, states, whitelist, rent, clusters, test tokens. |
| [IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md) | The order of work for the member portal, one step per session, each with a proof. |
| [../AGENTS.md](../AGENTS.md) | The rules for agents, the instructions, the error table and the data guide. |

## How to work

1. **Give the agent the rules.** Copy `AGENTS.md` and `CLAUDE.md` into the root of your app, or open your agent in this repository.
2. **One step per session.** Ask for one step of the implementation guide. Example: "Do step 3 of ia/IMPLEMENTATION_GUIDE.md."
3. **Ask for proof.** A screen, a transaction signature or an error code is proof. "It compiles" is not proof.
4. **Check the money rules yourself.** Read the code that sends transactions before you merge it.

Three things never go into an AI tool: private keys, seed phrases and personal data of members.
