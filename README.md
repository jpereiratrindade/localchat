# LocalChat

Interface local, simples e experimental para conversar com modelos servidos pelo Ollama.

A partir do P1, o projeto também funciona como uma pequena bancada de observação: identifica capacidades dos modelos instalados, separa modelos de chat de modelos de embedding e registra métricas fornecidas pelo Ollama ao final de cada resposta.

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

## Perfis locais

`model_profiles.json` enriquece os modelos encontrados pelo Ollama com metadados locais de uso experimental, sem alterar os pesos nem o manifesto do modelo.

Os perfis aceitam padrões glob (`*`) e podem classificar modelos por categoria, descrição e tags.

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

- P2: parâmetros experimentais por conversa/perfil;
- P3: modo Laboratório para comparação A/B entre modelos;
- P4: catálogo curado Ollama/Hugging Face;
- P5: embeddings, RAG e reranking.
