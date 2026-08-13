# LocalChat

Interface local, simples e experimental para conversar com modelos servidos pelo Ollama.

O projeto funciona também como uma pequena bancada de observação: identifica capacidades dos modelos instalados, separa modelos de chat de modelos de embedding, registra métricas fornecidas pelo Ollama e, a partir do P2, preserva um perfil experimental por conversa e um `context trace` por geração.

## Executar

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
./run.sh
```

Por padrão:

- Ollama: `http://127.0.0.1:11434`
- LocalChat: `http://127.0.0.1:5000`

Variáveis opcionais:

```bash
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export OLLAMA_MODEL=qwen2.5:14b
export LOCALCHAT_HOST=127.0.0.1
export LOCALCHAT_PORT=5000
export LOCALCHAT_MODEL_PROFILES="$PWD/model_profiles.json"
```

## Perfis locais de modelos

`model_profiles.json` enriquece os modelos encontrados pelo Ollama com metadados locais de uso experimental, sem alterar os pesos nem o manifesto do modelo.

Os perfis aceitam padrões glob (`*`) e podem classificar modelos por categoria, descrição e tags.

## Perfil experimental da conversa

Cada conversa pode fixar, sem obrigar valores artificiais:

- prompt de sistema;
- `temperature`;
- `top_p`;
- `seed`;
- `num_ctx`;
- `num_predict`.

Campos vazios preservam os padrões do próprio modelo/Ollama. O perfil é salvo na conversa; o último perfil salvo também pode ser herdado por um novo chat.

Cada resposta recebe um snapshot do perfil usado naquele momento. Alterar o perfil depois não reescreve os ensaios já executados.

## Context trace

Antes de retransmitir a resposta do Ollama, o backend registra um evento LocalChat com metadados do contexto sanitizado efetivamente encaminhado:

- modelo;
- digest do modelo resolvido no momento do ensaio;
- opções efetivamente aceitas pelo backend;
- quantidade e papéis das mensagens;
- tamanho em caracteres por mensagem;
- SHA-256 canônico do contexto;
- identificador único do trace.

A interface reconstrói o conteúdo a partir da própria conversa e compara sua contagem com o trace confirmado pelo backend. Assim é possível distinguir uma perda de contexto no LocalChat de uma resposta ruim do próprio modelo.

O conteúdo completo não é duplicado no trace persistido, evitando crescimento quadrático do `localStorage`.

## Métricas

Quando o Ollama envia o chunk final de uma resposta, o LocalChat preserva na conversa:

- tokens de entrada (`prompt_eval_count`);
- tokens de saída (`eval_count`);
- duração total;
- velocidade aproximada de geração em tokens/s;
- razão de término (`done_reason`).

As métricas são observacionais: não interferem na geração.

## Verificação

```bash
./scripts/verify.sh
```

Ou, individualmente:

```bash
python -m unittest discover -s tests -v
python -m py_compile app.py
node --check static/app.js
```

## Próximos incrementos

- P3: modo Laboratório para comparação A/B entre modelos;
- P4: catálogo curado Ollama/Hugging Face;
- P5: embeddings, RAG e reranking.
