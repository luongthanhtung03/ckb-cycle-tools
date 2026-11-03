# The spawn fixture: spawn-parent (a lock) spawns spawn-child, found by the
# data2 hash in its input cell's data. `make build` builds both, keeps a copy
# with the symbol table as <name>.debug (debug info stripped, to stay small)
# and strips the other; `make mocks` writes mocks/ from those builds with the
# npm ckb-testtool (make-mocks.mjs). tests/ builds the same transactions on
# Rust ckb-testtool, for a machine with a host C toolchain.
MODE := release
BUILD_DIR := build/$(MODE)
OBJCOPY ?= llvm-objcopy
CARGO_TARGET_DIR ?= target
CONTRACTS := spawn-parent spawn-child

build:
	cargo build --release --target riscv64imac-unknown-none-elf $(foreach c,$(CONTRACTS),-p $(c))
	mkdir -p $(BUILD_DIR)
	for c in $(CONTRACTS); do \
		$(OBJCOPY) --strip-debug $(CARGO_TARGET_DIR)/riscv64imac-unknown-none-elf/$(MODE)/$$c $(BUILD_DIR)/$$c.debug; \
		$(OBJCOPY) --strip-all $(CARGO_TARGET_DIR)/riscv64imac-unknown-none-elf/$(MODE)/$$c $(BUILD_DIR)/$$c; \
	done

mocks:
	cd ../../.. && node test/fixtures/spawn-project/make-mocks.mjs

test:
	cargo test -p tests

.PHONY: build mocks test
