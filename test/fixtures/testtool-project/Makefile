# The steps a ckb-script-templates project adds for cycle reports: `make cycles`.
# `build` stands in for the template's (which copies each contract to
# build/release/<name> and <name>.debug, then strips the first).
MODE := release
BUILD_DIR := build/$(MODE)
OBJCOPY ?= llvm-objcopy
CARGO_TARGET_DIR ?= target
# Where the tests write their transactions. Committed here, as test fixtures;
# a real project would use target/ckb-cycles.
CYCLES_MOCKS := mocks
CKB_CYCLES ?= npx -y -p ckb-cycle-tools ckb-cycles

build:
	cargo build -p args-loop --release --target riscv64imac-unknown-none-elf
	mkdir -p $(BUILD_DIR)
	cp $(CARGO_TARGET_DIR)/riscv64imac-unknown-none-elf/$(MODE)/args-loop $(BUILD_DIR)/args-loop
	cp $(BUILD_DIR)/args-loop $(BUILD_DIR)/args-loop.debug
	$(OBJCOPY) --strip-debug --strip-all $(BUILD_DIR)/args-loop

test:
	cargo test -p tests

cycles-config: build
	rm -rf $(CYCLES_MOCKS)
	CKB_CYCLES_MOCKS="$(abspath $(CYCLES_MOCKS))" cargo test -p tests
	$(CKB_CYCLES) scan $(CYCLES_MOCKS) --binaries $(BUILD_DIR) --functions -o cycles.json

cycles: cycles-config
	$(CKB_CYCLES) report cycles.json

.PHONY: build test cycles-config cycles
